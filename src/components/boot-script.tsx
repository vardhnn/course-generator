import Script from "next/script";

/**
 * Applies the persisted theme before first paint so there is no flash of the
 * wrong colour scheme on reload. Loaded via next/script with the
 * beforeInteractive strategy: rendering a bare <script> inside the React tree
 * makes React warn "Scripts inside React components are never executed when
 * rendering on the client", which was also the dev-tools issues badge.
 */
export function BootScript() {
  return (
    <Script
      id="rcs-boot-theme"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html: `try{var t=localStorage.getItem('rcs-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){}`,
      }}
    />
  );
}