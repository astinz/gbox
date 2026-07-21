import { ObservationNotch } from "@/components/observation-notch";
import { useObservationNotch } from "@/hooks/use-observation-notch";

export default function NotchApp() {
  const notch = useObservationNotch();
  return (
    <ObservationNotch
      phase={notch.phase}
      expanded={notch.expanded}
      previewingLatest={notch.previewingLatest}
      observation={notch.observation}
      queueDepth={notch.queueDepth}
      onReview={() => void notch.review()}
    />
  );
}
