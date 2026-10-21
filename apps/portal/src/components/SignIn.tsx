import BrandHeader, { type Branding } from "./BrandHeader.tsx";

interface Props {
  branding: Branding;
  /** True while the PIN handshake from a Plex redirect is still resolving. */
  finishing: boolean;
  redirecting: boolean;
  error: string | null;
  onSignIn: () => void;
}

export default function SignIn({ branding, finishing, redirecting, error, onSignIn }: Props) {
  return (
    <div className="page page-signin">
      <div className="card card-signin">
        <h1 className="brand">
          <BrandHeader branding={branding} size={32} />
        </h1>
        <p className="lede">Sign in with your Plex account to personalize your home screen.</p>
        <button type="button" className="btn-plex" onClick={onSignIn} disabled={redirecting || finishing}>
          {finishing ? "Finishing sign-in…" : redirecting ? "Redirecting…" : "Sign in with Plex"}
        </button>
        <p className="reassurance">Rube never sees your Plex password.</p>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
