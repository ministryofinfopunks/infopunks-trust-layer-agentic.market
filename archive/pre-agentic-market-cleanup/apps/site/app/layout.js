import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata = {
  title: "Infopunks Trust Score™",
  description: "The trust layer for agents. Decide which agents get the job in real time."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} bg-[var(--bg)] text-[var(--text-primary)] antialiased`}>
        {children}
      </body>
    </html>
  );
}
