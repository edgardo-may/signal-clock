export interface AuthIdentity { readonly userId: string }
export interface AuthProvider { verifyToken(token: string): Promise<AuthIdentity> }
