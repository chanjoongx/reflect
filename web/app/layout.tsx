import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "reflect Viewer";
const description =
  "Local viewer for reflect 0.2 sessions: each developer turn's verdict, the trigger window, the notes written and when the agent received them.";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title,
  description,
  applicationName: "reflect",
  authors: [{ name: "Chanjoong Kim", url: "https://github.com/chanjoongx" }],
  creator: "Chanjoong Kim",
  publisher: "Chanjoong Kim",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  openGraph: {
    type: "website",
    url: "http://localhost:3000",
    siteName: "reflect",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@chanjoongx",
  },
  other: {
    "format-detection": "telephone=no, date=no, address=no, email=no",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-ink-8)]">
        <Nav />
        <main className="flex-1 relative z-10">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
