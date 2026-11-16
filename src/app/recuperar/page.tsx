import { Suspense } from "react";
import { RecoverScreen } from "@/components/market-screens";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RecoverScreen />
    </Suspense>
  );
}
