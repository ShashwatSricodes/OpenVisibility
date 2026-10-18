import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { POSTS, getPost, formatDate, type Block } from "@/lib/posts";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — OpenVisibility`,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: "article" },
  };
}

function Body({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h2":
            return (
              <h2 key={i} className="t-h3 post-h2">
                {b.text}
              </h2>
            );
          case "code":
            return (
              <pre key={i} className="post-code">
                <code>{b.code}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={i} className="post-ul">
                {b.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            );
          default:
            return <p key={i}>{b.text}</p>;
        }
      })}
    </>
  );
}

export default async function PostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <>
      <Nav />
      <main className="page">
        <article className="wrap sec post">
          <div className="post-top">
            <Reveal>
              <Link href="/blog" className="eyebrow back">
                Blog
              </Link>
            </Reveal>
            <Reveal delay={0.1}>
              <h1 className="t-h2">{post.title}</h1>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="post-meta t-small">
                <span className="t-small-strong">{post.author.name}</span>
                <span>·</span>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span>·</span>
                <span>{post.readingTime}</span>
              </div>
            </Reveal>
          </div>

          <Reveal className="post-cover" delay={0.2}>
            <img
              src={post.cover}
              alt=""
              width={1032}
              height={800}
              fetchPriority="high"
              decoding="async"
            />
          </Reveal>

          <Reveal className="post-body t-body" delay={0.25}>
            <Body blocks={post.body} />
          </Reveal>

          <Reveal className="post-foot" delay={0.1}>
            <p className="t-body">Ready to point a form at us?</p>
            <Link href="/#pricing" className="btn btn-primary">
              Get a free key
            </Link>
          </Reveal>
        </article>
      </main>
      <Footer />
    </>
  );
}
