export interface Account {
  id: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: "sha1" | "sha256" | "sha512";
  digits: 6 | 8;
  period: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicAccount = Omit<Account, "secret">;
