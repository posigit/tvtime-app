import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BottomNav } from "@/components/bottom-nav";

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col pb-20">
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
