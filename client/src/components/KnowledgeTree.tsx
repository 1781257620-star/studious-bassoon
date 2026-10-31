import { useState, useMemo, useCallback } from 'react';
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
import { db } from '@client/src/services/db';

interface KnowledgeTreeProps {
  nodes: KnowledgeNode[];
  rootNode: KnowledgeNode | null;
}

const getChildren = (
  allNodes: KnowledgeNode[],
  parentId: string,
): KnowledgeNode[] => {
  return allNodes.filter((n: KnowledgeNode) => n.parentId === parentId);
};

const findNodeById = (
  allNodes: KnowledgeNode[],
  id: string,
): KnowledgeNode | undefined => {
  return allNodes.find((n: KnowledgeNode) => n.id === id);
};

const ExampleCard = ({ example }: { example: KnowledgeNode }) => {
  const exampleType = (example.elementType ?? 'example') as ElementType;
  const label = ELEMENT_LABELS[exampleType] || '例';
  const colorClass = ELEMENT_COLORS[exampleType] || 'bg-secondary text-muted-foreground';

  return (
    <div className="bg-secondary rounded-xl p-3">
      <div className="flex items-start gap-2 mb-1.5">
        <span
          className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md font-medium ${colorClass}`}
        >
          {label}
        </span>
        <h5 className="text-sm font-medium text-foreground leading-snug">
          {example.title}
        </h5>
      </div>
      {example.content && (
        <p className="text-sm text-foreground/85 leading-relaxed pl-1 whitespace-pre-wrap">
          {example.content}
        </p>
      )}
    </div>
  );
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
    <div className="mt-2">
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
              className="bg-accent/60 rounded-lg p-3 border-l-2 border-primary/40"
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

interface PointNodeProps {
  node: KnowledgeNode;
  allNodes: KnowledgeNode[];
  depth: number;
}

const PointNode = ({ node, allNodes, depth }: PointNodeProps) => {
  const [expanded, setExpanded] = useState(depth === 0);
  const children = useMemo(
    () => getChildren(allNodes, node.id),
    [allNodes, node.id],
  );

  const subpoints = children.filter(
    (c: KnowledgeNode) =>
      (c.nodeType === 'subpoint' || (!c.nodeType && c.level === 3 && children.length > 0)) &&
      c.nodeType !== 'action_item' &&
      c.nodeType !== 'action_list',
  );
  const examples = children.filter(
    (c: KnowledgeNode) => c.nodeType === 'element',
  );
  const quoteGroup = children.find(
    (c: KnowledgeNode) => c.nodeType === 'original_quote_group',
  );

  const hasContent = subpoints.length > 0 || examples.length > 0 || node.content || quoteGroup;

  return (
    <div className="rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => hasContent && setExpanded((prev) => !prev)}
        className={`w-full text-left py-2.5 flex items-start gap-2 ${
          hasContent ? 'active:scale-[0.98] transition-transform hover:bg-accent/40' : ''
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '12px' }}
        disabled={!hasContent}
      >
        {hasContent ? (
          <span className="flex-shrink-0 mt-0.5 text-primary">
            {expanded ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )}
          </span>
        ) : (
          <span className="flex-shrink-0 w-3.5 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground leading-snug">
            {node.title}
          </h4>
          {!expanded && node.content && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {node.content}
            </p>
          )}
          {!expanded && examples.length > 0 && (
            <p className="text-xs text-primary mt-1 font-medium">
              {examples.length} 个相关例子
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div
          className="pb-3 space-y-2"
          style={{ paddingLeft: `${20 + depth * 12}px`, paddingRight: '12px' }}
        >
          {node.content && (
            <p className="text-sm leading-relaxed text-foreground/90">
              {node.content}
            </p>
          )}
          {examples.length > 0 && (
            <div className="space-y-2 pt-1">
              {examples.map((el: KnowledgeNode) => (
                <ExampleCard key={el.id} example={el} />
              ))}
            </div>
          )}
          {quoteGroup && (
            <OriginalQuotes groupNode={quoteGroup} allNodes={allNodes} />
          )}
          {subpoints.length > 0 && (
            <div className="bg-card/60 rounded-lg border border-border/30">
              {subpoints.map((sp: KnowledgeNode) => (
                <PointNode
                  key={sp.id}
                  node={sp}
                  allNodes={allNodes}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface SectionCardProps {
  section: KnowledgeNode;
  index: number;
  allNodes: KnowledgeNode[];
}

const SectionCard = ({ section, index, allNodes }: SectionCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const subsections = useMemo(
    () => getChildren(allNodes, section.id).filter(
      (n: KnowledgeNode) => n.nodeType === 'point' || !n.nodeType,
    ),
    [allNodes, section.id],
  );

  return (
    <div className="bg-secondary/80 rounded-2xl shadow-sm border border-border/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left p-5 active:scale-[0.98] transition-transform hover:bg-accent/20"
      >
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-foreground leading-snug">
              {section.title}
            </h3>
            {section.summary && (
              <p className="text-sm text-muted-foreground mt-1">
                {section.summary}
              </p>
            )}
          </div>
          <span className="flex-shrink-0 mt-1 text-primary">
            {expanded ? (
              <ChevronDown size={18} />
            ) : (
              <ChevronRight size={18} />
            )}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-4">
          <div className="bg-card/60 rounded-xl p-2">
            {subsections.map((sub: KnowledgeNode) => (
              <PointNode
                key={sub.id}
                node={sub}
                allNodes={allNodes}
                depth={0}
              />
            ))}
          </div>
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
    <blockquote className="border-l-4 border-primary pl-5 py-2">
      <p className="text-base text-foreground/90 leading-relaxed font-medium italic">
        {closingNode.content}
      </p>
    </blockquote>
  );
};

const KnowledgeTree = ({ nodes, rootNode }: KnowledgeTreeProps) => {
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

  const totalPoints = useMemo(() => {
    return sectionNodes.reduce((acc: number, s: KnowledgeNode) => {
      const subs = nodes.filter((n: KnowledgeNode) => n.parentId === s.id);
      return acc + subs.length;
    }, 0);
  }, [sectionNodes, nodes]);

  if (!rootNode || nodes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        暂无精读笔记
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 全景总览区 */}
      <div className="bg-gradient-to-br from-primary/10 to-accent rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wide">
            知识树全景
          </span>
        </div>
        <h1 className="text-xl font-bold text-foreground leading-tight mb-2">
          {rootNode.title}
        </h1>
        {rootNode.content && (
          <p className="text-xs text-muted-foreground mb-3">{rootNode.content}</p>
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
          共 {sectionNodes.length} 板块 · {totalPoints} 子议题
        </div>
      </div>

      {/* 导语区 */}
      {introNode && introNode.content && (
        <div className="bg-card rounded-2xl p-5 shadow-sm border border-border/40">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-foreground">
              导语
            </span>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">
            {introNode.content}
          </p>
        </div>
      )}

      {/* 板块卡片列表 */}
      <div className="space-y-4">
        {sectionNodes.map((section: KnowledgeNode, idx: number) => (
          <SectionCard
            key={section.id}
            section={section}
            index={idx}
            allNodes={nodes}
          />
        ))}
      </div>

      {/* 收尾 */}
      {closingNode && closingNode.content && (
        <ClosingSection closingNode={closingNode} />
      )}
    </div>
  );
};

export default KnowledgeTree;
