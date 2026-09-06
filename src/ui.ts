import type { Request, Response } from "express";
import { env } from "./config/env.js";

export const homePage = (_req: Request, res: Response) => {
  res.render("index", {
    title: "Authy Vault Dashboard",
    appName: "Authy Vault",
    logoDevToken: env.LOGO_DEV_PUBLISHABLE_KEY
  });
};
