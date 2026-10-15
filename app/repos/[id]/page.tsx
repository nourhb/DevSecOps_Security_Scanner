import { RepoDetail } from "@/components/repo-detail";

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <RepoDetail id={id} />
    </main>
  );
}
