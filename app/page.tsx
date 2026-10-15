import { DashboardView } from "@/components/dashboard-view";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <DashboardView />
    </main>
  );
}
