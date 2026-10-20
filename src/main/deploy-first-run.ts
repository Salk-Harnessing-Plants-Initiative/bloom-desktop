/**
 * Squirrel starts the app with --squirrel-firstrun right after Setup.exe installs it.
 * During a station deploy that install runs from the GitHub runner service, so the app
 * would start in a session nobody sees and open the database while the deploy is still
 * verifying. The deploy script sets BLOOM_DEPLOY_SKIP_FIRSTRUN=1, which the installer
 * passes on, and the app quits before doing anything. The operator's first normal
 * launch does the usual startup.
 */
export const DEPLOY_SKIP_FIRSTRUN_VARIABLE = 'BLOOM_DEPLOY_SKIP_FIRSTRUN';

export function isDeployFirstRun(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return (
    argv.includes('--squirrel-firstrun') &&
    env[DEPLOY_SKIP_FIRSTRUN_VARIABLE] === '1'
  );
}
