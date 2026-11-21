export function createSearchableSelect({ onChange, placeholder = "Search..." } = {}) {
    let allOptions = [];
    let filteredOptions = [];
    let currentValue = "";
    let isDisabled = false;
    let isOpen = false;
    let highlightIndex = 0;

    // Trigger button styled to match .h3-input
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "h3-input";
    trigger.style.display = "flex";
    trigger.style.alignItems = "center";
    trigger.style.justifyContent = "space-between";
    trigger.style.gap = "6px";
    trigger.style.textAlign = "left";
    trigger.style.cursor = "pointer";
    trigger.style.minWidth = "0";
    trigger.style.overflow = "hidden";

    const labelSpan = document.createElement("span");
    labelSpan.style.flex = "1";
    labelSpan.style.minWidth = "0";
    labelSpan.style.overflow = "hidden";
    labelSpan.style.textOverflow = "ellipsis";
    labelSpan.style.whiteSpace = "nowrap";

    const arrowSpan = document.createElement("span");
    arrowSpan.innerText = "▾";
    arrowSpan.style.flexShrink = "0";
    arrowSpan.style.fontSize = "10px";
    arrowSpan.style.color = "#888888";

    trigger.appendChild(labelSpan);
    trigger.appendChild(arrowSpan);

    // Floating dropdown menu (appended to document.body when open)
    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.zIndex = "99999";
    menu.style.background = "#161616";
    menu.style.border = "1px solid #555555";
    menu.style.borderRadius = "4px";
    menu.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.75)";
    menu.style.display = "none";
    menu.style.flexDirection = "column";
    menu.style.boxSizing = "border-box";
    menu.style.fontFamily = "sans-serif";
    menu.style.fontSize = "11px";
    menu.style.color = "#ffffff";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = placeholder;
    searchInput.style.width = "100%";
    searchInput.style.boxSizing = "border-box";
    searchInput.style.padding = "5px 7px";
    searchInput.style.background = "#111111";
    searchInput.style.color = "#ffffff";
    searchInput.style.border = "none";
    searchInput.style.borderBottom = "1px solid #333333";
    searchInput.style.outline = "none";
    searchInput.style.fontSize = "11px";

    const listEl = document.createElement("div");
    listEl.style.maxHeight = "220px";
    listEl.style.overflowY = "auto";
    listEl.style.overflowX = "hidden";
    listEl.style.scrollbarWidth = "thin";
    listEl.style.scrollbarColor = "#444444 #161616";

    menu.appendChild(searchInput);
    menu.appendChild(listEl);

    const stopProp = (e) => e.stopPropagation();
    trigger.addEventListener("mousedown", stopProp);
    menu.addEventListener("mousedown", stopProp);
    menu.addEventListener("wheel", stopProp, { passive: true });

    const renderList = () => {
        listEl.innerHTML = "";

        if (filteredOptions.length === 0) {
            const empty = document.createElement("div");
            empty.innerText = "No matches";
            empty.style.padding = "6px 8px";
            empty.style.color = "#666666";
            empty.style.fontStyle = "italic";
            listEl.appendChild(empty);
            return;
        }

        filteredOptions.forEach((item, idx) => {
            const row = document.createElement("div");
            row.innerText = item;
            row.title = item;
            row.style.padding = "5px 8px";
            row.style.cursor = "pointer";
            row.style.whiteSpace = "nowrap";
            row.style.overflow = "hidden";
            row.style.textOverflow = "ellipsis";

            const isHighlighted = idx === highlightIndex;
            const isSelected = item === currentValue;

            if (isHighlighted) {
                row.style.background = "rgba(130, 222, 255, 0.22)";
                row.style.color = "#82deff";
            } else if (isSelected) {
                row.style.background = "rgba(255, 255, 255, 0.06)";
                row.style.color = "#ffffff";
            } else {
                row.style.background = "transparent";
                row.style.color = "#dddddd";
            }

            if (isSelected) {
                row.style.fontWeight = "bold";
            }

            row.addEventListener("mouseenter", () => {
                highlightIndex = idx;
                updateRowStyles();
            });

            row.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                selectValue(item);
            });

            listEl.appendChild(row);
        });
    };

    const updateRowStyles = () => {
        const rows = listEl.children;
        for (let i = 0; i < rows.length; i++) {
            const item = filteredOptions[i];
            const isHighlighted = i === highlightIndex;
            const isSelected = item === currentValue;
            if (isHighlighted) {
                rows[i].style.background = "rgba(130, 222, 255, 0.22)";
                rows[i].style.color = "#82deff";
            } else if (isSelected) {
                rows[i].style.background = "rgba(255, 255, 255, 0.06)";
                rows[i].style.color = "#ffffff";
            } else {
                rows[i].style.background = "transparent";
                rows[i].style.color = "#dddddd";
            }
        }
    };

    const scrollHighlightedIntoView = () => {
        const activeRow = listEl.children[highlightIndex];
        if (activeRow) {
            activeRow.scrollIntoView({ block: "nearest" });
        }
    };

    const applyFilter = (query) => {
        const q = query.trim().toLowerCase();
        if (!q) {
            filteredOptions = allOptions.slice();
            const currentIdx = filteredOptions.indexOf(currentValue);
            highlightIndex = currentIdx >= 0 ? currentIdx : 0;
        } else {
            const tokens = q.split(/\s+/);
            const matches = allOptions.filter(item => {
                const lower = item.toLowerCase();
                return tokens.every(t => lower.includes(t));
            });

            // Sort closest matches first: startsWith > filename startsWith > earlier index
            matches.sort((a, b) => {
                const al = a.toLowerCase();
                const bl = b.toLowerCase();
                const aBase = al.split("/").pop();
                const bBase = bl.split("/").pop();
                const aStart = al.startsWith(q) || aBase.startsWith(q) ? 0 : 1;
                const bStart = bl.startsWith(q) || bBase.startsWith(q) ? 0 : 1;
                if (aStart !== bStart) return aStart - bStart;
                return al.indexOf(q) - bl.indexOf(q);
            });

            filteredOptions = matches;
            highlightIndex = 0;
        }
        renderList();
        scrollHighlightedIntoView();
    };

    const positionMenu = () => {
        const rect = trigger.getBoundingClientRect();
        const menuWidth = Math.max(rect.width, 220);
        const spaceBelow = window.innerHeight - rect.bottom;
        const estimatedHeight = 256;

        menu.style.width = `${menuWidth}px`;
        menu.style.left = `${Math.min(rect.left, window.innerWidth - menuWidth - 8)}px`;

        if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
            menu.style.top = "auto";
            menu.style.bottom = `${window.innerHeight - rect.top + 2}px`;
        } else {
            menu.style.bottom = "auto";
            menu.style.top = `${rect.bottom + 2}px`;
        }
    };

    const onOutsideMouseDown = (e) => {
        if (!menu.contains(e.target) && !trigger.contains(e.target)) {
            closeMenu();
        }
    };

    const onWindowResize = () => {
        if (isOpen) positionMenu();
    };

    const openMenu = () => {
        if (isDisabled || isOpen) return;
        isOpen = true;
        if (!menu.parentNode) {
            document.body.appendChild(menu);
        }
        searchInput.value = "";
        applyFilter("");
        positionMenu();
        menu.style.display = "flex";
        requestAnimationFrame(() => {
            searchInput.focus();
            scrollHighlightedIntoView();
        });
        window.addEventListener("mousedown", onOutsideMouseDown, true);
        window.addEventListener("resize", onWindowResize);
    };

    const closeMenu = () => {
        if (!isOpen) return;
        isOpen = false;
        menu.style.display = "none";
        window.removeEventListener("mousedown", onOutsideMouseDown, true);
        window.removeEventListener("resize", onWindowResize);
    };

    const selectValue = (val) => {
        const changed = currentValue !== val;
        currentValue = val;
        labelSpan.innerText = val || "";
        trigger.title = val || "";
        closeMenu();
        if (changed && onChange) {
            onChange(val);
        }
    };

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isOpen) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    searchInput.addEventListener("input", (e) => {
        applyFilter(e.target.value);
    });

    searchInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filteredOptions.length > 0) {
                highlightIndex = (highlightIndex + 1) % filteredOptions.length;
                updateRowStyles();
                scrollHighlightedIntoView();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filteredOptions.length > 0) {
                highlightIndex = (highlightIndex - 1 + filteredOptions.length) % filteredOptions.length;
                updateRowStyles();
                scrollHighlightedIntoView();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filteredOptions.length > 0 && filteredOptions[highlightIndex] !== undefined) {
                selectValue(filteredOptions[highlightIndex]);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            closeMenu();
        }
    });

    return {
        element: trigger,
        setOptions(items, val) {
            allOptions = (items || []).slice();
            if (val !== undefined && allOptions.includes(val)) {
                currentValue = val;
            } else if (!allOptions.includes(currentValue)) {
                currentValue = allOptions[0] || "";
            }
            labelSpan.innerText = currentValue;
            trigger.title = currentValue;
            if (isOpen) applyFilter(searchInput.value);
        },
        setValue(val) {
            if (val !== undefined && (allOptions.length === 0 || allOptions.includes(val))) {
                currentValue = val;
                labelSpan.innerText = val;
                trigger.title = val;
            }
        },
        getValue() {
            return currentValue;
        },
        setDisabled(disabled) {
            isDisabled = Boolean(disabled);
            trigger.disabled = isDisabled;
            trigger.style.opacity = isDisabled ? "0.45" : "1";
            trigger.style.cursor = isDisabled ? "not-allowed" : "pointer";
            if (isDisabled) closeMenu();
        },
        setTitle(titleText) {
            trigger.title = titleText || currentValue || "";
        }
    };
}