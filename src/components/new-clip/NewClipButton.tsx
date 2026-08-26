import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import { FileVideo2, FolderOpen, Plus, Trash2, Upload, UploadCloud, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { uploadVideo } from '../../lib/videoApi';
import './NewClipButton.css';

const MAX_VIDEO_DURATION_SECONDS = 10 * 60;

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

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes.toFixed(1)} MB`;
}

export function NewClipButton({ onUploaded }: NewClipButtonProps = {}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  function closeModal() {
    setIsOpen(false);
    setIsDragging(false);
    setError('');
    setIsSending(false);
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

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);

      if (video.duration > MAX_VIDEO_DURATION_SECONDS) {
        setError('O vídeo precisa ter no máximo 10 minutos.');
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

  return (
    <>
      <button className="primary-action" type="button" onClick={() => setIsOpen(true)}>
        <Plus size={18} />
        Novo clip
      </button>

      {isOpen && (
        <div className="new-clip-backdrop" role="presentation">
          <section className="new-clip-modal" aria-labelledby="new-clip-title" role="dialog">
            <div className="new-clip-header">
              <div>
                <p className="eyebrow">Novo clip</p>
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
              <p>Use um arquivo de vídeo com até 10 minutos.</p>
            </div>

            <div className="new-clip-actions">
              <button className="new-clip-option" type="button" onClick={openFileManager}>
                <FolderOpen size={20} />
                Selecionar no gerenciador
              </button>
            </div>

            <div className="new-clip-tutorial">
              <h3>Como começar</h3>
              <ol>
                <li>Arraste o arquivo para a área acima ou selecione pelo gerenciador.</li>
                <li>Confirme que o vídeo tem no máximo 10 minutos.</li>
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
                disabled={!selectedVideo || isSending}
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
