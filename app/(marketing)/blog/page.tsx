import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { POSTS, formatDate } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog — OpenVisibility",
  description: "Notes on AI search visibility, measurement, and keeping API costs honest.",
};

export default function BlogIndex() {
  return (
    <>
      <Nav />
      <main className="page">
        <section className="wrap sec" id="blog">
          <div className="sec-head blog-head">
            <Reveal>
              <span className="eyebrow">Blog</span>
            </Reveal>
            <Reveal delay={0.1}>
              <h2 className="t-h2">
                Notes on AI visibility{" "}
                <span className="dim">
                  on measurement, citations, and what tracking really costs.
                </span>
              </h2>
            </Reveal>
          </div>

          <div className="posts">
            {POSTS.map((p, i) => (
              <Reveal key={p.slug} delay={0.1 * i} className="post-card" as="article">
                <Link href={`/blog/${p.slug}`} className="post-link">
                  <div className="ab-img">
                    <img
                      src={p.cover}
                      alt=""
                      width={1032}
                      height={800}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="post-meta t-small">
                    <span>{p.tag}</span>
                    <span>·</span>
                    <time dateTime={p.date}>{formatDate(p.date)}</time>
                    <span>·</span>
                    <span>{p.readingTime}</span>
                  </div>
                  <div className="ab-txt">
                    <h3 className="t-h3">{p.title}</h3>
                    <p className="t-body">{p.excerpt}</p>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
