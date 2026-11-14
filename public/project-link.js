export function projectLink(label, url, className, onError = () => {}) {
  const link = document.createElement("a");
  link.textContent = label;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (className) link.className = className;
  if (window.desktop)
    link.onclick = async (event) => {
      event.preventDefault();
      try {
        await window.desktop.openExternal(link.href);
      } catch (error) {
        onError(error.message);
      }
    };
  return link;
}
