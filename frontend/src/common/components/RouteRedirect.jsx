import React from "react";
import { Navigate, useParams, useLocation } from "react-router-dom";

/**
 * Redirect que preserva params de la URL y query string.
 *
 * Útil para mover rutas a una nueva ubicación canónica sin romper enlaces
 * existentes (bookmarks, emails, links externos, QRs viejos).
 *
 * Ejemplo:
 *   <Route path="/old/path/:id" element={
 *     <RouteRedirect to="/new/path/:id" />
 *   } />
 *
 *   /old/path/42?detail=5  →  /new/path/42?detail=5
 *
 * Si un param opcional no está en la URL actual (`:id?`), se elimina de
 * la URL destino para no quedar literal "/:id?" en el path final.
 */
export default function RouteRedirect({ to }) {
  const params = useParams();
  const location = useLocation();
  let path = to;
  for (const [key, val] of Object.entries(params)) {
    if (val != null && val !== "") {
      path = path.replace(`:${key}?`, val).replace(`:${key}`, val);
    }
  }
  // Limpia params opcionales no presentes (`/:foo?` → vacío).
  path = path.replace(/\/:[a-zA-Z]+\??/g, "");
  return (
    <Navigate
      to={`${path}${location.search || ""}${location.hash || ""}`}
      replace
    />
  );
}
