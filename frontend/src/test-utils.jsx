/**
 * Test utilities para Hormiqual.
 *
 * Los tests deben mockear manualmente los modulos que necesiten:
 *   jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn(), useParams: () => ({}) }));
 *   jest.mock("../../../../context/ToastContext", () => ({ useToast: () => jest.fn() }));
 *   jest.mock("../../../../context/UserContext", () => ({ useUserContext: () => ({ user: {...} }) }));
 *
 * Este archivo re-exporta @testing-library/react para conveniencia.
 */
export * from "@testing-library/react";
