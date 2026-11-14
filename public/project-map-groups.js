// Display-only groups in the distant atlas. Work data and saved positions are
// never merged; zooming in restores each district's original controls.
// Atlas labels are up to 120 screen pixels wide; reserve a small gap as well.
export function projectMapGroups(projects,layout,zoom,radius=132){
  const entries=projects.filter(project=>Number.isFinite(layout[project.id]?.x)&&Number.isFinite(layout[project.id]?.y))
    .map(project=>({project,x:layout[project.id].x+500,y:layout[project.id].y+320}))
    .sort((a,b)=>String(a.project.id).localeCompare(String(b.project.id)));
  const scale=Number.isFinite(zoom)&&zoom>0?zoom:1,seen=new Set(),groups=[];
  for(let start=0;start<entries.length;start++){
    if(seen.has(start))continue;
    const members=[],queue=[start];seen.add(start);
    for(let index=0;index<queue.length;index++){
      const current=entries[queue[index]];members.push(current);
      for(let next=0;next<entries.length;next++)if(!seen.has(next)&&
        Math.hypot(entries[next].x-current.x,entries[next].y-current.y)*scale<=radius){
        seen.add(next);queue.push(next);
      }
    }
    members.sort((a,b)=>String(a.project.id).localeCompare(String(b.project.id)));
    groups.push({ids:members.map(member=>member.project.id),projects:members.map(member=>member.project),
      x:members.reduce((sum,member)=>sum+member.x,0)/members.length,
      y:members.reduce((sum,member)=>sum+member.y,0)/members.length});
  }
  return groups;
}
