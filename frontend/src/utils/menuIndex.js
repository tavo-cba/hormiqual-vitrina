export const flattenMenusToIndex = (arr = [], parents = []) => {
    const result = [];

    arr.forEach((menu) => {
        if (!menu) return;

        const title = menu.nombre || menu.titulo;
        const route = menu.ruta;
        const keywordList = [];

        if (title) keywordList.push(title);
        if (route) keywordList.push(route);
        if (parents.length) keywordList.push(...parents);

        if (menu.keywords) {
            if (Array.isArray(menu.keywords)) {
                keywordList.push(...menu.keywords.filter(Boolean));
            } else {
                keywordList.push(menu.keywords);
            }
        }

        if (route && title) {
            result.push({
                ruta: route,
                titulo: title,
                keywords: keywordList,
                parentPath: parents.filter(Boolean).join(' › ') || null,
            });
        }

        if (menu.children && menu.children.length) {
            result.push(...flattenMenusToIndex(menu.children, [...parents, title].filter(Boolean)));
        }
    });

    return result;
};