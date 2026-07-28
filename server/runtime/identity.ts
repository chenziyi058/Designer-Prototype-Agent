const OWNER_COOKIE = "designer_prototype_owner";
const OWNER_HEADER = "x-designer-owner-id";
const SAFE_OWNER = /^[a-zA-Z0-9@._:+-]{8,160}$/;

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function resolveRequestOwner(request: Request) {
  const authenticatedEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim();
  if (authenticatedEmail && SAFE_OWNER.test(authenticatedEmail)) {
    return `user:${authenticatedEmail.toLowerCase()}`;
  }

  const anonymousId =
    request.headers.get(OWNER_HEADER)?.trim() ||
    readCookie(request, OWNER_COOKIE).trim();
  if (anonymousId && SAFE_OWNER.test(anonymousId)) {
    return `anonymous:${anonymousId}`;
  }

  return "anonymous:unidentified";
}

export const anonymousIdentity = {
  cookieName: OWNER_COOKIE,
  headerName: OWNER_HEADER,
};
