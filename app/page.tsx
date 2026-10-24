import { requireUser } from "../lib/auth-page";
import WordstepsApp from "./components/wordsteps-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  return <WordstepsApp initialName={user.displayName} />;
}
