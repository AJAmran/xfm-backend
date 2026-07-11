import jwt, { Secret, SignOptions } from "jsonwebtoken";

/** Create a signed JWT with the given payload and expiry duration */
const generateToken = (
  payload: Record<string, string>,
  secret: Secret,
  expiresIn: string,
): string => {
  return jwt.sign(payload, secret, {
    expiresIn,
  } as SignOptions);
};

/** Verify and decode a JWT, throwing on invalid/expired tokens */
const verifyToken = (token: string, secret: Secret): jwt.JwtPayload => {
  return jwt.verify(token, secret) as jwt.JwtPayload;
};

export const jwtHelpers = {
  generateToken,
  verifyToken,
};