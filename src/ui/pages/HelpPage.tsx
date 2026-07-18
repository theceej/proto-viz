import { Link } from 'react-router-dom';

/** Built-in user guide: one scannable page, linked from the sidebar. */
export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Help</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        proto-viz is a playground for network protocols: compose a protocol stack,
        see every field bit by bit, edit values, and export real PCAP files.
        Everything runs in your browser — uploads, custom protocols, and captures
        never leave your machine.
      </p>

      <Section title="Building a stack">
        <p>
          On the <Link className={link} to="/builder">Stack Builder</Link>, use{' '}
          <Ui>Add layer</Ui> to append protocols, outermost first. The palette dims
          protocols that can't legally follow the current stack and explains why —
          validity comes from real encapsulation rules (EtherType, IP Protocol, port
          assignments), so a VXLAN overlay or Q-in-Q stack works the way it does on
          the wire. Selector fields such as EtherType are set automatically from the
          layer that follows.
        </p>
        <p>
          Reorder layers by dragging a chip's grip handle — or focus the handle and
          press <Key>Space</Key> to lift, arrow keys to move, <Key>Space</Key> to
          drop. The <Ui>Presets</Ui> menu has common stacks; <Ui>Random</Ui>{' '}
          generates a valid stack by walking the encapsulation graph.
        </p>
      </Section>

      <Section title="Reading and editing packets">
        <p>
          The three panes show the same packet three ways: a typed field editor,
          RFC-style bit diagrams, and a hex dump. Hovering or focusing a field in
          any pane highlights it in all of them; click (or press <Key>Enter</Key>{' '}
          on a diagram field) to lock the highlight. Each pane collapses via the
          chevron in its header — hide the diagrams to give the editor and hex dump
          the full width.
        </p>
        <p>
          Computed fields — lengths, IHL, checksums including TCP/UDP pseudo-header
          sums — update live as you edit and show a lock icon. Pin one to force a
          deliberately wrong value (for testing malformed-packet handling); the
          serializer warns rather than silently correcting it. The payload editor
          accepts text or hex, and the dice button fills it with random bytes.
        </p>
      </Section>

      <Section title="Saving and sharing">
        <p>
          <Ui>Save</Ui> stores the full stack — including field edits and payload —
          in your browser (IndexedDB), reloadable from <Ui>Saved</Ui>.{' '}
          <Ui>Share</Ui> turns the layer sequence into a short word code like{' '}
          <code className={code}>army.borrow.advice</code>: read it to a colleague or
          send the link, and it opens the same stack. Codes have a checksum, so a
          mistyped word is rejected instead of loading the wrong stack. They carry
          the layer composition of built-in protocols only — field edits, payload,
          and custom protocols are not included.
        </p>
        <p>
          <Ui>Decode</Ui> works the other way around: paste packet hex (from the
          hex view's copy button, or Wireshark's “copy as hex stream”) and the
          layers are identified by following the same field assignments that
          validate stacks — EtherType, IP protocol, ports. Computed fields are
          recalculated; any that don't match the pasted bytes (say, a wrong
          checksum) are pinned so the exact bytes are preserved. Content that
          can't be identified structurally stays as raw payload, with a note
          explaining why.
        </p>
      </Section>

      <Section title="Exporting PCAPs">
        <p>
          <Ui>Export PCAP</Ui> writes a classic pcap file openable in Wireshark or
          tcpdump. Beyond a single packet, scenario generators produce coherent
          sequences — TCP three-way handshake, DNS query/response, ICMP ping pair,
          DHCP DORA — with flipped directions and fresh checksums. To verify
          checksums in Wireshark, enable{' '}
          <em>Preferences → Protocols → IPv4 / TCP / UDP → Validate checksums</em>.
        </p>
      </Section>

      <Section title="Importing protocol specs">
        <p>
          <Link className={link} to="/import">Import Spec</Link> accepts an RFC or
          protocol spec as TXT, HTML, DOCX, or PDF, finds ASCII packet diagrams, and
          proposes a field layout with confidence scores. Nothing is saved until you
          review and confirm it; imported protocols then appear in the{' '}
          <Link className={link} to="/library">Protocol Library</Link> and can join
          stacks like any built-in. Plain-text RFCs parse best — PDF column
          alignment is reconstructed and may need touch-ups in the review step.
          Custom protocols can be exported and imported as JSON from the library.
        </p>
      </Section>

      <Section title="Keyboard reference">
        <table className="mt-1 w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] tracking-widest text-zinc-500 uppercase">
              <th className="py-1 pr-4 font-semibold">Keys</th>
              <th className="py-1 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {SHORTCUTS.map(([keys, action]) => (
              <tr key={action} className="border-t border-zinc-800">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  {keys.map((k, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-zinc-600"> / </span>}
                      <Key>{k}</Key>
                    </span>
                  ))}
                </td>
                <td className="py-1.5 text-zinc-400">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Privacy and license">
        <p>
          proto-viz has no server: nothing you upload, build, or export leaves your
          browser. It is free software under the GNU GPL v3 — source, issues, and
          the full license text live on{' '}
          <a
            className={link}
            href="https://github.com/theceej/proto-viz"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
          . © 2026 proto-viz contributors.
        </p>
      </Section>
    </div>
  );
}

const link = 'text-cyan-300 underline decoration-cyan-300/40 hover:decoration-cyan-300';
const code =
  'rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[12px] text-cyan-300';

const SHORTCUTS: [string[], string][] = [
  [['Ctrl/⌘ + Z'], 'Undo the last stack edit'],
  [['Ctrl/⌘ + Shift + Z'], 'Redo the last undone edit'],
  [['Tab'], 'Move through layers, fields, and diagram cells'],
  [['Enter', 'Space'], 'Lock or unlock the highlight on a focused diagram field'],
  [['Space'], 'On a layer grip handle: lift the layer; arrows move it, Space drops'],
  [['Escape'], 'Close any dialog or menu'],
];

/** Keyboard key. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
      {children}
    </kbd>
  );
}

/** Name of a button or menu in the app. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-zinc-200">{children}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[15px] font-semibold text-zinc-100">{title}</h2>
      <div className="mt-2 flex flex-col gap-2.5 text-[13px] leading-relaxed text-zinc-400">
        {children}
      </div>
    </section>
  );
}
