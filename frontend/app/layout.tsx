import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "ArtFrame — AI media forensics",
  description:
    "Detect AI-generated images, video, and audio with transparent forensic signals. Responsible synthetic media, watermarked by default.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#17171a",
              color: "#f3f1ea",
              border: "1px solid #2a2a2f",
              fontSize: "13px",
              borderRadius: "8px",
            },
            success: { iconTheme: { primary: "#7dc47a", secondary: "#0a0a0b" } },
            error: { iconTheme: { primary: "#e8663c", secondary: "#0a0a0b" } },
          }}
        />
      </body>
    </html>
  );
}
