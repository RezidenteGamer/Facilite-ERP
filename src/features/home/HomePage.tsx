import { useState } from "react";
import { DEFAULT_HOME_LAYOUT, HOME_LAYOUTS, type HomeLayoutId } from "./layouts";

/**
 * Tela inicial pós-login. `layout` ainda não tem UI para ser trocado — quando
 * o botão de "trocar layout" existir, ele só precisa chamar `setLayout`
 * com "original" | "foco" | "desktop".
 */
export default function HomePage() {
  const [layout] = useState<HomeLayoutId>(DEFAULT_HOME_LAYOUT);

  const Layout = HOME_LAYOUTS[layout] ?? HOME_LAYOUTS[DEFAULT_HOME_LAYOUT];

  if (!Layout) {
    return null;
  }

  return <Layout />;
}
