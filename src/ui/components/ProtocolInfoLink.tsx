import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Small (i) link from a protocol name to its Protocol Library entry.
 * Used wherever the builder names a full protocol.
 */
export default function ProtocolInfoLink({
  protocolId,
  name,
}: {
  protocolId: string;
  name: string;
}) {
  return (
    <Link
      to={`/library/${protocolId}`}
      className="text-zinc-600 transition-colors hover:text-cyan-300 focus-visible:text-cyan-300"
      title={`View ${name} in the protocol library`}
      aria-label={`View ${name} in the protocol library`}
    >
      <Info className="size-3.5" aria-hidden />
    </Link>
  );
}
