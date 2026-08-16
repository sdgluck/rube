import Modal from "#components/Modal";
import UploadDropzone from "./UploadDropzone";

/**
 * The upload journey, behind a CTA rather than occupying the top of the page.
 *
 * Closes as soon as files are handed over: the upload itself is tracked on the
 * page, so holding the modal open would only hide the grid while it runs.
 */
export default function UploadModal({
  disabled,
  onClose,
  onFiles,
}: {
  disabled?: boolean;
  onClose: () => void;
  onFiles: (files: File[]) => void;
}) {
  return (
    <Modal open onClose={onClose} title="Upload prerolls" size="md">
      <UploadDropzone
        disabled={disabled}
        onFiles={(files) => {
          onFiles(files);
          onClose();
        }}
      />
    </Modal>
  );
}
