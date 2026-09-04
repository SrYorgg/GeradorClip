import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import { FileVideo2, FolderOpen, Link2, Plus, Trash2, Upload, UploadCloud, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { importVideoFromUrl, uploadVideo } from '../../lib/videoApi';
import { formatDuration, formatFileSize } from '../../lib/formatters';
import { MAX_IMPORT_URL_LENGTH, MAX_VIDEO_FILE_SIZE_BYTES, MIN_CLIP_DURATION_SECONDS } from '../../lib/videoRules';
import './NewClipButton.css';

type SelectedVideo = {
  file: File;
  name: string;
  duration: string;
  durationSeconds: number;
  size: string;
};

type NewClipButtonProps = {
  onUploaded?: () => void;
};

export function NewClipButton({ onUploaded }: NewClipButtonProps = {}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  function closeModal() {
    setIsOpen(false);
    setIsDragging(false);
    setError('');
    setIsSending(false);
    setIsImporting(false);
    setSelectedVideo(null);
    setSourceUrl('');
  }

  function openFileManager() {
    inputRef.current?.click();
  }

  function validateVideo(file: File) {
    setError('');
    setSelectedVideo(null);

    if (!file.type.startsWith('video/')) {
      setError('Selecione um arquivo de vídeo válido.');
      return;
    }

    if (file.size > MAX_VIDEO_FILE_SIZE_BYTES) {
      setError('O vídeo excede o limite de 1 GB.');
      return;
    }

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);

      if (!Number.isFinite(video.duration) || video.duration < MIN_CLIP_DURATION_SECONDS) {
        setError(`O vídeo precisa ter pelo menos ${MIN_CLIP_DURATION_SECONDS} segundos.`);
        return;
      }

      setSelectedVideo({
        file,
        name: file.name,
        duration: formatDuration(video.duration),
        durationSeconds: video.duration,
        size: formatFileSize(file.size),
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError('Não foi possível ler a duração desse vídeo.');
    };
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      validateVideo(file);
    }

    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];

    if (file) {
      validateVideo(file);
    }
  }

  function cancelSelectedVideo() {
    setSelectedVideo(null);
    setError('');
  }

  async function sendVideo() {
    if (!selectedVideo) {
      setError('Selecione um vídeo antes de enviar.');
      return;
    }

    try {
      setIsSending(true);
      await uploadVideo(selectedVideo.file, selectedVideo.durationSeconds);
      closeModal();
      onUploaded?.();
      navigate('/arquivos');
    } catch {
      setError('Não foi possível armazenar o vídeo na aplicação.');
    } finally {
      setIsSending(false);
    }
  }

  async function sendUrl() {
    const normalizedUrl = sourceUrl.trim();
    if (!normalizedUrl) {
      setError('Cole um link de vídeo antes de importar.');
      return;
    }

    if (normalizedUrl.length > MAX_IMPORT_URL_LENGTH) {
      setError(`O link precisa ter no máximo ${MAX_IMPORT_URL_LENGTH} caracteres.`);
      return;
    }

    try {
      const parsedUrl = new URL(normalizedUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('unsupported-protocol');
      }
    } catch {
      setError('Informe um link de vídeo válido.');
      return;
    }

    try {
      setIsImporting(true);
      setError('');
      await importVideoFromUrl(normalizedUrl);
      closeModal();
      onUploaded?.();
      navigate('/arquivos');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar o vídeo pelo link.');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <button className="primary-action" type="button" onClick={() => setIsOpen(true)}>
        <Plus size={18} />
        Novo vídeo
      </button>

      {isOpen && (
        <div className="new-clip-backdrop" role="presentation">
          <section className="new-clip-modal" aria-labelledby="new-clip-title" aria-modal="true" role="dialog">
            <div className="new-clip-header">
              <div>
                <p className="eyebrow">Novo vídeo</p>
                <h2 id="new-clip-title">Adicionar vídeo bruto</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Fechar" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div
              className={`new-clip-dropzone${isDragging ? ' is-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <div className="new-clip-drop-icon">
                <UploadCloud size={32} />
              </div>
              <h3>Arraste o vídeo aqui</h3>
              <p>Use um arquivo de vídeo com pelo menos {MIN_CLIP_DURATION_SECONDS} segundos, sem limite de duração.</p>
            </div>

            <div className="new-clip-actions">
              <button className="new-clip-option" type="button" onClick={openFileManager}>
                <FolderOpen size={20} />
                Selecionar no gerenciador
              </button>
            </div>

            <div className="new-clip-url-import">
              <div className="new-clip-url-heading">
                <Link2 size={20} />
                <div>
                  <h3>Importar por link</h3>
                  <p>YouTube e outros sites suportados pelo yt-dlp, sem limite de duração.</p>
                </div>
              </div>
              <div className="new-clip-url-form">
                <input
                  type="url"
                  aria-label="Link do vídeo"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
                <button className="new-clip-option" type="button" disabled={isImporting || isSending} onClick={() => void sendUrl()}>
                  <Link2 size={17} />
                  {isImporting ? 'Baixando...' : 'Importar link'}
                </button>
              </div>
              <small>Em vídeos do YouTube, o ClipCut tenta encontrar os momentos mais assistidos. Links com <code>?t=1m30s&amp;end=2m</code> baixam somente essa minutagem.</small>
            </div>

            <div className="new-clip-tutorial">
              <h3>Como começar</h3>
              <ol>
                <li>Arraste o arquivo para a área acima ou selecione pelo gerenciador.</li>
                <li>Vídeos longos podem ser analisados e divididos em cortes com duração flexível.</li>
                <li>Depois do envio, o arquivo deve ser salvo em `public/videos`.</li>
              </ol>
            </div>

            {error && <p className="new-clip-error">{error}</p>}

            {selectedVideo && (
              <div className="new-clip-selected">
                <FileVideo2 size={20} />
                <div>
                  <strong>{selectedVideo.name}</strong>
                  <span>
                    {selectedVideo.duration} - {selectedVideo.size}
                  </span>
                </div>
                <button
                  className="new-clip-trash"
                  type="button"
                  aria-label="Cancelar envio do vídeo"
                  onClick={cancelSelectedVideo}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            )}

            <div className="new-clip-footer-actions">
              <button className="secondary-action" type="button" onClick={closeModal}>
                <X size={16} />
                Fechar
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!selectedVideo || isSending || isImporting}
                onClick={sendVideo}
              >
                <Upload size={16} />
                {isSending ? 'Enviando...' : 'Enviar vídeo'}
              </button>
            </div>

            <input
              ref={inputRef}
              className="new-clip-input"
              type="file"
              accept="video/*"
              onChange={handleFileChange}
            />
          </section>
        </div>
      )}
    </>
  );
}
