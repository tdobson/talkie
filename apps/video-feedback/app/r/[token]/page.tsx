import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReviewApp } from '@/components/review/ReviewApp';
import { copy } from '@/lib/review/copy';
import { loadReviewPage } from '@/lib/review/page';

type Props = { params: Promise<{ token: string }> };

// The link is the only key to the video: it is looked up on every request, never cached.
export const dynamic = 'force-dynamic';

const robots = { index: false, follow: false };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const page = await loadReviewPage(token);
  return { title: page ? copy.pageTitle(page.title) : copy.invalid.title, robots };
}

export default async function ReviewPage({ params }: Props) {
  const { token } = await params;
  const page = await loadReviewPage(token);
  if (page === null) notFound();
  return (
    <ReviewApp
      token={token}
      title={page.title}
      latestVersion={page.latestVersion}
      frameDuration={page.frameDuration}
      frameDurations={page.frameDurations}
      mediaKinds={page.mediaKinds}
    />
  );
}
