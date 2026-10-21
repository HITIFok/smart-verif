import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // GitHub Pages : URL projet servie sous /smart-verif/ (base Vite) ; racine sinon.
    basepath: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
  });

  return router;
};
