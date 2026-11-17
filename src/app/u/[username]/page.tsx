import { PublicProfile } from "@/components/extra-screens";

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <PublicProfile username={username} />;
}
