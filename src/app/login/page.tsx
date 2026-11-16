import { Suspense } from "react";
import { LoginScreen } from "@/components/market-screens";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
