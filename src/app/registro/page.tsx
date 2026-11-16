import { Suspense } from "react";
import { RegisterScreen } from "@/components/market-screens";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RegisterScreen />
    </Suspense>
  );
}
