import type { Request, Response } from "express";

export const homePage = (_req: Request, res: Response) => {
  res.render("index", {
    title: "Authy Vault Dashboard",
    appName: "Authy Vault",
  });
};
