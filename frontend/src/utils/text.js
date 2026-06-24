export const normalizeText = (text = "") =>
    (text ?? "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

export const includesText = (text, term) => {
    const normalizedTerm = normalizeText(term).trim();
    if (!normalizedTerm) return true;
    return normalizeText(text).includes(normalizedTerm);
};