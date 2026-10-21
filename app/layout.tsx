import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/vt323/400.css";
import "@fontsource/press-start-2p/400.css";
import "./globals.css";
import { AppWalletProvider } from "@/components/WalletContext";
import { Sidebar, Topbar } from "@/components/Nav";
import { Spotlight } from "@/components/Spotlight";

export const metadata: Metadata = {
  title: "FIREPAD — launch on pump.fun, share creator fees",
  description:
    "Launch on pump.fun or connect your coin. Its creator fee is split 50/50 between the creator and holders, locked by pump.fun. An AI agent markets every coin, and every launch gets a contract address ending in fire.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <AppWalletProvider>
          <div className="flex">
            <Sidebar />
            <div className="min-w-0 flex-1">
              <Topbar />
              <main className="mx-auto max-w-7xl px-4 pb-10 pt-6 lg:px-6">{children}</main>
              <footer className="mx-auto hidden max-w-7xl items-center justify-between border-t border-line px-6 py-6 text-xs text-muted lg:flex">
                <span>© {new Date().getFullYear()} FIREPAD. Digital assets are risky. Only use what you can afford to lose.</span>
                <span className="flex gap-5">
                  <Link href="/how-it-works" className="hover:text-white">
                    How it works
                  </Link>
                  <Link href="/how-it-works#fees" className="hover:text-white">
                    Fees
                  </Link>
                  <Link href="/how-it-works#faq" className="hover:text-white">
                    FAQ
                  </Link>
                </span>
              </footer>
            </div>
          </div>
          <Spotlight />
        </AppWalletProvider>
      </body>
    </html>
  );
}
