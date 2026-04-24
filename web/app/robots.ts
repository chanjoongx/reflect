import type { MetadataRoute } from "next";

// The Viewer binds to 127.0.0.1 by default and is not intended for public
// hosting. If it is ever accidentally exposed, deny every crawler.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
