import type { Metadata } from "next";
import { Host_Grotesk, Inter } from "next/font/google";
import { MobileNav, Sidebar } from "./_components/sidebar";
import "./app.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-host-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "OpenVisibility", template: "%s · OpenVisibility" },
  robots: { index: false },
};

/* Applies the saved or system theme before first paint, so dark mode never flashes white. */
const themeScript = `try{var t=localStorage.getItem("ov-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

/* Root layout for the product; the landing page has its own in (marketing). */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${hostGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <MobileNav />
          <Sidebar />
          <div className="lg:py-2 lg:pr-2">
            <div className="min-h-screen bg-panel lg:min-h-[calc(100vh-1rem)] lg:rounded-md lg:border lg:border-line">
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
