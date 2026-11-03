import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Lightbulb,
  FileText,
} from 'lucide-react';
import {
  ELEMENT_LABELS,
  ELEMENT_COLORS,
} from '@client/src/types/book';
import type { KnowledgeNode, ElementType } from '@client/src/types/book';
import { Markdown } from '@client/src/components/ui/markdown';
import type { Components } from 'react-markdown';

const mdComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-foreground mt-6 mb-3 pb-2 border-b border-border/50">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-foreground mt-5 mb-2">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-foreground mt-4 mb-1.5">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="text-sm text-foreground/90 leading-relaxed my-2">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-2 space-y-1.5 marker:text-primary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1.5 marker:text-primary marker:font-semibold">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-foreground/90 leading-relaxed pl-1">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary pl-4 py-2 bg-accent/30 rounded-r-xl my-3 italic text-foreground/85 text-sm">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => (
    <strong className="text-foreground font-semibold">{children}</strong>
  ),
};

interface KnowledgeTreeProps {
  nodes: KnowledgeNode[];
  rootNode: KnowledgeNode | null;
  author?: string;
}

const getChildren = (
  allNodes: KnowledgeNode[],
  parentId: string,
): KnowledgeNode[] => {
  return allNodes.filter((n: KnowledgeNode) => n.parentId === parentId);
};

interface OriginalQuotesProps {
  groupNode: KnowledgeNode;
  allNodes: KnowledgeNode[];
}

const OriginalQuotes = ({ groupNode, allNodes }: OriginalQuotesProps) => {
  const [expanded, setExpanded] = useState(false);
  const quotes = useMemo(
    () => getChildren(allNodes, groupNode.id),
    [allNodes, groupNode.id],
  );

  if (quotes.length === 0) return null;

  return (
    <div className="mt-2 ml-4">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-primary font-medium active:scale-[0.98] transition-transform hover:underline underline-offset-2"
      >
        <FileText size={12} />
        原文 {quotes.length} 段
        {expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {quotes.map((q: KnowledgeNode) => (
            <div
              key={q.id}
              className="bg-accent/40 rounded-lg p-3 border-l-2 border-primary/40"
            >
              <p className="text-sm text-foreground/90 leading-relaxed italic">
                "{q.content}"
              </p>
              {q.quoteChapter && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  —— {q.quoteChapter}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface PointItemProps {
  node: KnowledgeNode;
  allNodes: KnowledgeNode[];
}

const PointItem = ({ node, allNodes }: PointItemProps) => {
  const children = useMemo(
    () => getChildren(allNodes, node.id),
    [allNodes, node.id],
  );

  const examples = children.filter(
    (c: KnowledgeNode) => c.nodeType === 'element',
  );
  const quoteGroup = children.find(
    (c: KnowledgeNode) => c.nodeType === 'original_quote_group',
  );

  return (
    <div className="flex gap-2">
      <span className="text-primary mt-1.5 flex-shrink-0 text-xs leading-none">
        •
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed text-foreground/90">
          <span className="font-semibold text-foreground">{node.title}：</span>
          {node.content || ''}
        </p>
        {examples.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {examples.map((el: KnowledgeNode) => {
              const exampleType = (el.elementType ?? 'example') as ElementType;
              const label = ELEMENT_LABELS[exampleType] || '例';
              const colorClass = ELEMENT_COLORS[exampleType] || 'bg-secondary text-muted-foreground';
              return (
                <div key={el.id} className="text-xs text-muted-foreground pl-3">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium mr-1 ${colorClass}`}>
                    {label}
                  </span>
                  <span className="font-medium text-foreground/80">{el.title}</span>
                  {el.content && <span> — {el.content}</span>}
                </div>
              );
            })}
          </div>
        )}
        {quoteGroup && (
          <OriginalQuotes groupNode={quoteGroup} allNodes={allNodes} />
        )}
      </div>
    </div>
  );
};

interface SubsectionProps {
  node: KnowledgeNode;
  allNodes: KnowledgeNode[];
}

const Subsection = ({ node, allNodes }: SubsectionProps) => {
  const children = useMemo(
    () => getChildren(allNodes, node.id),
    [allNodes, node.id],
  );

  const points = children.filter(
    (c: KnowledgeNode) => c.nodeType === 'point' || !c.nodeType,
  );
  const quoteGroup = children.find(
    (c: KnowledgeNode) => c.nodeType === 'original_quote_group',
  );

  const hasSubPoints = points.length > 0;

  if (!hasSubPoints) {
    return (
      <div className="mt-2">
        <PointItem node={node} allNodes={allNodes} />
      </div>
    );
  }

  return (
    <div className="mt-3">
      <h4 className="text-sm font-semibold text-foreground mb-2">
        {node.title}
      </h4>
      {node.content && (
        <p className="text-xs text-muted-foreground mb-2">{node.content}</p>
      )}
      <div className="space-y-1.5">
        {points.map((p: KnowledgeNode) => (
          <PointItem key={p.id} node={p} allNodes={allNodes} />
        ))}
      </div>
      {quoteGroup && (
        <OriginalQuotes groupNode={quoteGroup} allNodes={allNodes} />
      )}
    </div>
  );
};

interface SectionBlockProps {
  section: KnowledgeNode;
  allNodes: KnowledgeNode[];
}

const SectionBlock = ({ section, allNodes }: SectionBlockProps) => {
  const subsections = useMemo(
    () => getChildren(allNodes, section.id).filter(
      (n: KnowledgeNode) => n.nodeType === 'point' || !n.nodeType,
    ),
    [allNodes, section.id],
  );

  return (
    <div>
      <h3 className="text-lg font-bold text-foreground mb-1">
        {section.title}
      </h3>
      {section.summary && (
        <p className="text-sm text-muted-foreground mb-3">
          {section.summary}
        </p>
      )}
      {subsections.length > 0 && (
        <div className="space-y-1">
          {subsections.map((sub: KnowledgeNode) => (
            <Subsection key={sub.id} node={sub} allNodes={allNodes} />
          ))}
        </div>
      )}
    </div>
  );
};

interface ClosingSectionProps {
  closingNode: KnowledgeNode;
}

const ClosingSection = ({ closingNode }: ClosingSectionProps) => {
  return (
    <blockquote className="border-l-4 border-primary pl-5 py-2 bg-accent/30 rounded-r-xl">
      <p className="text-base text-foreground/90 leading-relaxed font-medium italic">
        {closingNode.content}
      </p>
    </blockquote>
  );
};

const KnowledgeTree = ({ nodes, rootNode, author }: KnowledgeTreeProps) => {
  const topLevel = useMemo(() => {
    if (!rootNode) return [];
    return nodes.filter((n: KnowledgeNode) => n.parentId === rootNode.id);
  }, [rootNode, nodes]);

  const introNode = useMemo(
    () => topLevel.find((n: KnowledgeNode) => n.nodeType === 'intro'),
    [topLevel],
  );

  const closingNode = useMemo(
    () => topLevel.find((n: KnowledgeNode) => n.nodeType === 'closing'),
    [topLevel],
  );

  const contentNode = useMemo(
    () => topLevel.find((n: KnowledgeNode) => n.nodeType === 'content_markdown'),
    [topLevel],
  );

  const sectionNodes = useMemo(
    () => topLevel.filter(
      (n: KnowledgeNode) =>
        (n.nodeType === 'section' || !n.nodeType) &&
        n.title !== '总结与行动' &&
        n.title !== '金句收束' &&
        n.title !== '一句话总结' &&
        n.title !== '行动清单',
    ),
    [topLevel],
  );

  const { sectionCount, pointCount } = useMemo(() => {
    if (contentNode && contentNode.content) {
      const md = contentNode.content;
      const h2Matches = md.match(/^##\s/gm);
      const bulletMatches = md.match(/^[-*]\s/gm);
      return {
        sectionCount: h2Matches ? h2Matches.length : 0,
        pointCount: bulletMatches ? bulletMatches.length : 0,
      };
    }
    const totalPoints = sectionNodes.reduce((acc: number, s: KnowledgeNode) => {
      const subs = nodes.filter((n: KnowledgeNode) => n.parentId === s.id);
      return acc + subs.length;
    }, 0);
    return { sectionCount: sectionNodes.length, pointCount: totalPoints };
  }, [contentNode, sectionNodes, nodes]);

  if (!rootNode || nodes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        暂无精读笔记
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 全景总览区 */}
      <div className="bg-gradient-to-br from-primary/10 to-accent rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wide">
            知识树全景
          </span>
        </div>
        <h1 className="text-xl font-bold text-foreground leading-tight mb-1">
          {rootNode.title}
        </h1>
        {author && (
          <p className="text-sm text-muted-foreground mb-3">作者：{author}</p>
        )}
        {rootNode.summary && (
          <div className="mb-3 px-3 py-2 bg-primary/10 rounded-xl border border-primary/20">
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-semibold text-primary">核心主线：</span>
              {rootNode.summary}
            </p>
          </div>
        )}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/80 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          共 {sectionCount} 板块 · {pointCount} 要点
        </div>
      </div>

      {/* 导语区 */}
      {introNode && introNode.content && (
        <div className="bg-card/60 rounded-2xl p-5 border border-border/40">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={16} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">
              导语
            </span>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">
            {introNode.content}
          </p>
        </div>
      )}

      {/* 内容区：优先用 content_markdown 渲染，旧数据 fallback 到 section 列表 */}
      {contentNode && contentNode.content ? (
        <div className="knowledge-tree-md">
          <Markdown components={mdComponents}>
            {contentNode.content}
          </Markdown>
        </div>
      ) : (
        <div className="space-y-6">
          {sectionNodes.map((section: KnowledgeNode) => (
            <SectionBlock
              key={section.id}
              section={section}
              allNodes={nodes}
            />
          ))}
        </div>
      )}

      {/* 收尾 */}
      {closingNode && closingNode.content && (
        <ClosingSection closingNode={closingNode} />
      )}
    </div>
  );
};

export default KnowledgeTree;
