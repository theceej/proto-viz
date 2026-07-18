import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LayerHint } from '../../../core/model';
import { extractSpecText, type ExtractedText } from '../../../import/extract/text';
import { findDiagrams, type DiagramParse } from '../../../import/diagram';
import { findProseFields } from '../../../import/fieldList';
import { buildDraft, draftToDefinition, kebabCase, type DraftField } from '../../../import/draft';
import { useLibraryStore } from '../../../store/libraryStore';
import { saveCustomProtocol } from '../../../store/persistence';
import type { Claim, Step } from './constants';
import { claimsToEncapsulations, proseToDraftFields } from './draftMapping';
import { StepIndicator } from './atoms';
import UploadStep from './UploadStep';
import PickStep from './PickStep';
import ReviewStep from './ReviewStep';
import MetadataStep from './MetadataStep';

export default function ImportWizard() {
  const navigate = useNavigate();
  const addCustom = useLibraryStore((s) => s.addCustom);

  const [step, setStep] = useState<Step>('upload');
  const [extracted, setExtracted] = useState<ExtractedText | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramParse[]>([]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [confidence, setConfidence] = useState(1);

  const [protoName, setProtoName] = useState('');
  const [protoId, setProtoId] = useState('');
  const [layerHint, setLayerHint] = useState<LayerHint>('application');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [claims, setClaims] = useState<Claim[]>([{ namespaceId: 'udp-dstport', value: '' }]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const ingest = async (file: File) => {
    setUploadError(null);
    try {
      const result = await extractSpecText(file);
      setExtracted(result);
      setFileName(file.name);
      const found = findDiagrams(result.text);
      setDiagrams(found);
      const base = file.name.replace(/\.[a-z0-9]+$/i, '');
      setProtoName(base);
      setProtoId(kebabCase(base));
      setStep('pick');
    } catch (e) {
      setUploadError((e as Error).message);
    }
  };

  const pickDiagram = (d: DiagramParse) => {
    const draft = buildDraft(d, protoName);
    setFields(draft.fields);
    setDraftWarnings(draft.warnings);
    setConfidence(draft.confidence);
    setStep('review');
  };

  const pickProse = () => {
    if (!extracted) return;
    setFields(proseToDraftFields(findProseFields(extracted.text)));
    setDraftWarnings(['Built from the prose field list — verify order and widths.']);
    setConfidence(0.5);
    setStep('review');
  };

  const setName = (v: string) => {
    setProtoName(v);
    setProtoId(kebabCase(v));
  };

  const save = async () => {
    setSaveError(null);
    try {
      const def = draftToDefinition(
        { name: protoName, fields, warnings: [], confidence },
        {
          id: protoId,
          name: protoName,
          layerHint,
          description: description || undefined,
          references: reference ? [reference] : undefined,
          encapsulations: claimsToEncapsulations(claims),
        },
      );
      addCustom(def);
      await saveCustomProtocol(def);
      navigate(`/library/${def.id}`);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-6">
      <header className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Import a Protocol Spec
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Upload an RFC or spec (TXT, HTML, DOCX, PDF). Packet diagrams are detected and
          parsed; you review everything before it joins the library.
        </p>
        <StepIndicator step={step} />
      </header>

      {step === 'upload' && <UploadStep onFile={ingest} error={uploadError} />}

      {step === 'pick' && extracted && (
        <PickStep
          extracted={extracted}
          fileName={fileName}
          diagrams={diagrams}
          onPick={pickDiagram}
          onProse={pickProse}
          onBack={() => setStep('upload')}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          fields={fields}
          setFields={setFields}
          warnings={draftWarnings}
          confidence={confidence}
          onBack={() => setStep('pick')}
          onNext={() => setStep('metadata')}
        />
      )}

      {step === 'metadata' && (
        <MetadataStep
          protoName={protoName}
          onNameChange={setName}
          protoId={protoId}
          onIdChange={setProtoId}
          layerHint={layerHint}
          onLayerHintChange={setLayerHint}
          description={description}
          onDescriptionChange={setDescription}
          reference={reference}
          onReferenceChange={setReference}
          claims={claims}
          onClaimsChange={setClaims}
          saveError={saveError}
          canSave={Boolean(protoName && protoId && fields.length > 0)}
          onBack={() => setStep('review')}
          onSave={save}
        />
      )}
    </div>
  );
}
