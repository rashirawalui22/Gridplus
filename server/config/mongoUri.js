const encodedCredentialReservedCharacters = /[/:?#\[\]@!$&'()*+,;=]/;
const malformedEscape = /%(?![0-9a-f]{2})/i;

export function validateMongoUri(uri) {
  if (typeof uri !== 'string' || !uri) {
    throw new Error('MongoDB URI must be a non-empty string.');
  }
  if (uri !== uri.trim() || /[\u0000-\u0020\u007f]/.test(uri)) {
    throw new Error('MongoDB URI must not contain whitespace or control characters.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MongoDB URI must use the mongodb:// or mongodb+srv:// scheme.');
  }
  if (malformedEscape.test(uri)) {
    throw new Error('MongoDB URI contains invalid percent encoding; URL-encode credentials and option values.');
  }
  if (uri.includes('#')) {
    throw new Error('MongoDB URI must not contain an unencoded fragment; URL-encode reserved characters.');
  }

  const schemeEnd = uri.indexOf('//') + 2;
  const authority = uri.slice(schemeEnd).split(/[/?#]/, 1)[0];
  if (!authority) throw new Error('MongoDB URI must include a host.');

  const atSigns = authority.match(/@/g) ?? [];
  if (atSigns.length > 1) {
    throw new Error('MongoDB URI credentials must be URL-encoded; encode reserved characters in the username and password.');
  }

  const atIndex = authority.lastIndexOf('@');
  const userInfo = atIndex < 0 ? '' : authority.slice(0, atIndex);
  const hostList = (atIndex < 0 ? authority : authority.slice(atIndex + 1)).split(',');
  if (hostList.some((host) => !host)) throw new Error('MongoDB URI contains an empty host.');

  if (userInfo) {
    const separator = userInfo.indexOf(':');
    const username = separator < 0 ? userInfo : userInfo.slice(0, separator);
    const password = separator < 0 ? '' : userInfo.slice(separator + 1);
    if (encodedCredentialReservedCharacters.test(username) || encodedCredentialReservedCharacters.test(password)) {
      throw new Error('MongoDB URI credentials must be URL-encoded; encode reserved characters in the username and password.');
    }
    try {
      decodeURIComponent(username);
      decodeURIComponent(password);
    } catch {
      throw new Error('MongoDB URI credentials contain invalid percent encoding.');
    }
  }

  const isSrv = /^mongodb\+srv:\/\//i.test(uri);
  if (isSrv && (hostList.length !== 1 || hostList[0].includes(':'))) {
    throw new Error('mongodb+srv:// URIs must use one host and must not specify a port.');
  }

  const queryIndex = uri.indexOf('?');
  const query = queryIndex < 0 ? '' : uri.slice(queryIndex + 1);
  const options = new Map(
    [...new URLSearchParams(query)].map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]),
  );
  const isEnabled = (value) => value !== undefined && !['false', '0', 'no'].includes(value);
  const isExplicitlyEnabled = (value) => ['true', '1', 'yes'].includes(value);
  const isDisabled = (value) => value !== undefined && ['false', '0', 'no', ''].includes(value);
  if (
    ['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames']
      .some((key) => isEnabled(options.get(key)))
  ) {
    throw new Error('MongoDB TLS certificate and hostname verification must remain enabled.');
  }
  if (['tls', 'ssl'].some((key) => isDisabled(options.get(key)))) {
    throw new Error('MongoDB TLS must not be disabled.');
  }

  const isAtlas = hostList.some((host) => {
    const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
    return hostname.toLowerCase() === 'mongodb.net' || hostname.toLowerCase().endsWith('.mongodb.net');
  });
  if (isAtlas && !isSrv && !isExplicitlyEnabled(options.get('tls')) && !isExplicitlyEnabled(options.get('ssl'))) {
    throw new Error('Atlas mongodb:// URIs must specify tls=true; prefer the mongodb+srv:// connection string.');
  }

  return uri;
}

export function resolveMongoUri(environment = process.env) {
  const current = environment.MONGODB_URI ?? '';
  const legacy = environment.MONGO_URI ?? '';
  if (typeof current !== 'string' || typeof legacy !== 'string') {
    throw new Error('MONGODB_URI and MONGO_URI must be strings.');
  }
  if (current.trim() !== current || legacy.trim() !== legacy) {
    throw new Error('MONGODB_URI and MONGO_URI must not contain surrounding whitespace.');
  }
  if (current && legacy && current !== legacy) {
    throw new Error('Set only one MongoDB URI variable, or set MONGODB_URI and MONGO_URI to the same value.');
  }
  const uri = current || legacy;
  return uri ? validateMongoUri(uri) : '';
}

export function sanitizeMongoError(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Unknown MongoDB error.';
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB URI redacted]');
}
