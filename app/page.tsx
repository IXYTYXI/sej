import { requireChatGPTUser } from "./chatgpt-auth";
import WordstepsApp from "./components/wordsteps-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <WordstepsApp initialName={user.displayName} />;
}
