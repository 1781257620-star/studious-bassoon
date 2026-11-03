export type BookStatus = 'done' | 'processing' | 'pending';

export interface SampleBook {
  id: string;
  title: string;
  author: string;
  status: BookStatus;
  statusLabel: string;
  progress?: number;
  coverColor: string;
}

export const sampleBooks: SampleBook[] = [
  {
    id: '1',
    title: '人类简史',
    author: '尤瓦尔·赫拉利',
    status: 'done',
    statusLabel: '已生成知识树',
    progress: 100,
    coverColor: '#8B6F47',
  },
  {
    id: '2',
    title: '思考，快与慢',
    author: '丹尼尔·卡尼曼',
    status: 'processing',
    statusLabel: '处理中',
    progress: 65,
    coverColor: '#3F7F76',
  },
  {
    id: '3',
    title: '百年孤独',
    author: '加西亚·马尔克斯',
    status: 'processing',
    statusLabel: '实体识别中',
    progress: 30,
    coverColor: '#B07156',
  },
  {
    id: '4',
    title: '道德经',
    author: '老子',
    status: 'pending',
    statusLabel: '待处理',
    coverColor: '#7A8279',
  },
  {
    id: '5',
    title: '原则',
    author: '瑞·达利欧',
    status: 'pending',
    statusLabel: '待下载',
    coverColor: '#5C6B73',
  },
];
