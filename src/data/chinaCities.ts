// 全国省级行政区 + 全部地级市(及自治州/地区/盟) + 经纬度(市政府驻地近似,2 位小数足够天气查询)。
// 供首页天气网格「换省份」使用。直辖市/特别行政区作为单条。
export type City = { name: string; lon: number; lat: number }
export const CHINA_PROVINCES: { name: string; cities: City[] }[] = [
  { name: '北京', cities: [{ name: '北京', lon: 116.41, lat: 39.90 }] },
  { name: '天津', cities: [{ name: '天津', lon: 117.20, lat: 39.13 }] },
  { name: '上海', cities: [{ name: '上海', lon: 121.47, lat: 31.23 }] },
  { name: '重庆', cities: [{ name: '重庆', lon: 106.55, lat: 29.56 }] },
  { name: '河北', cities: [
    { name: '石家庄', lon: 114.51, lat: 38.04 }, { name: '唐山', lon: 118.18, lat: 39.63 }, { name: '秦皇岛', lon: 119.60, lat: 39.94 },
    { name: '邯郸', lon: 114.49, lat: 36.61 }, { name: '邢台', lon: 114.51, lat: 37.07 }, { name: '保定', lon: 115.46, lat: 38.87 },
    { name: '张家口', lon: 114.89, lat: 40.82 }, { name: '承德', lon: 117.96, lat: 40.99 }, { name: '沧州', lon: 116.84, lat: 38.30 },
    { name: '廊坊', lon: 116.70, lat: 39.52 }, { name: '衡水', lon: 115.67, lat: 37.74 } ] },
  { name: '山西', cities: [
    { name: '太原', lon: 112.55, lat: 37.87 }, { name: '大同', lon: 113.30, lat: 40.08 }, { name: '阳泉', lon: 113.58, lat: 37.86 },
    { name: '长治', lon: 113.12, lat: 36.20 }, { name: '晋城', lon: 112.85, lat: 35.49 }, { name: '朔州', lon: 112.43, lat: 39.33 },
    { name: '晋中', lon: 112.75, lat: 37.69 }, { name: '运城', lon: 111.00, lat: 35.03 }, { name: '忻州', lon: 112.73, lat: 38.42 },
    { name: '临汾', lon: 111.52, lat: 36.08 }, { name: '吕梁', lon: 111.14, lat: 37.52 } ] },
  { name: '内蒙古', cities: [
    { name: '呼和浩特', lon: 111.75, lat: 40.84 }, { name: '包头', lon: 109.84, lat: 40.66 }, { name: '乌海', lon: 106.79, lat: 39.66 },
    { name: '赤峰', lon: 118.92, lat: 42.26 }, { name: '通辽', lon: 122.24, lat: 43.65 }, { name: '鄂尔多斯', lon: 109.78, lat: 39.61 },
    { name: '呼伦贝尔', lon: 119.77, lat: 49.21 }, { name: '巴彦淖尔', lon: 107.39, lat: 40.74 }, { name: '乌兰察布', lon: 113.13, lat: 41.03 },
    { name: '兴安盟', lon: 122.07, lat: 46.08 }, { name: '锡林郭勒', lon: 116.05, lat: 43.94 }, { name: '阿拉善', lon: 105.73, lat: 38.85 } ] },
  { name: '辽宁', cities: [
    { name: '沈阳', lon: 123.43, lat: 41.80 }, { name: '大连', lon: 121.62, lat: 38.91 }, { name: '鞍山', lon: 122.99, lat: 41.11 },
    { name: '抚顺', lon: 123.96, lat: 41.88 }, { name: '本溪', lon: 123.77, lat: 41.30 }, { name: '丹东', lon: 124.38, lat: 40.00 },
    { name: '锦州', lon: 121.13, lat: 41.10 }, { name: '营口', lon: 122.24, lat: 40.67 }, { name: '阜新', lon: 121.67, lat: 42.02 },
    { name: '辽阳', lon: 123.18, lat: 41.27 }, { name: '盘锦', lon: 122.07, lat: 41.12 }, { name: '铁岭', lon: 123.84, lat: 42.29 },
    { name: '朝阳', lon: 120.45, lat: 41.57 }, { name: '葫芦岛', lon: 120.86, lat: 40.71 } ] },
  { name: '吉林', cities: [
    { name: '长春', lon: 125.32, lat: 43.82 }, { name: '吉林', lon: 126.55, lat: 43.84 }, { name: '四平', lon: 124.35, lat: 43.17 },
    { name: '辽源', lon: 125.14, lat: 42.89 }, { name: '通化', lon: 125.94, lat: 41.73 }, { name: '白山', lon: 126.42, lat: 41.94 },
    { name: '松原', lon: 124.82, lat: 45.14 }, { name: '白城', lon: 122.84, lat: 45.62 }, { name: '延边', lon: 129.51, lat: 42.89 } ] },
  { name: '黑龙江', cities: [
    { name: '哈尔滨', lon: 126.53, lat: 45.80 }, { name: '齐齐哈尔', lon: 123.92, lat: 47.35 }, { name: '鸡西', lon: 130.97, lat: 45.30 },
    { name: '鹤岗', lon: 130.27, lat: 47.33 }, { name: '双鸭山', lon: 131.16, lat: 46.65 }, { name: '大庆', lon: 125.11, lat: 46.59 },
    { name: '伊春', lon: 128.84, lat: 47.73 }, { name: '佳木斯', lon: 130.32, lat: 46.81 }, { name: '七台河', lon: 131.00, lat: 45.77 },
    { name: '牡丹江', lon: 129.62, lat: 44.55 }, { name: '黑河', lon: 127.50, lat: 50.25 }, { name: '绥化', lon: 126.99, lat: 46.64 },
    { name: '大兴安岭', lon: 124.71, lat: 51.92 } ] },
  { name: '江苏', cities: [
    { name: '南京', lon: 118.80, lat: 32.06 }, { name: '无锡', lon: 120.30, lat: 31.57 }, { name: '徐州', lon: 117.18, lat: 34.27 },
    { name: '常州', lon: 119.95, lat: 31.78 }, { name: '苏州', lon: 120.62, lat: 31.30 }, { name: '南通', lon: 120.86, lat: 31.98 },
    { name: '连云港', lon: 119.18, lat: 34.60 }, { name: '淮安', lon: 119.02, lat: 33.61 }, { name: '盐城', lon: 120.16, lat: 33.35 },
    { name: '扬州', lon: 119.41, lat: 32.39 }, { name: '镇江', lon: 119.45, lat: 32.20 }, { name: '泰州', lon: 119.92, lat: 32.46 },
    { name: '宿迁', lon: 118.28, lat: 33.96 } ] },
  { name: '浙江', cities: [
    { name: '杭州', lon: 120.16, lat: 30.27 }, { name: '宁波', lon: 121.55, lat: 29.87 }, { name: '温州', lon: 120.70, lat: 28.00 },
    { name: '嘉兴', lon: 120.76, lat: 30.75 }, { name: '湖州', lon: 120.09, lat: 30.89 }, { name: '绍兴', lon: 120.58, lat: 30.05 },
    { name: '金华', lon: 119.65, lat: 29.08 }, { name: '衢州', lon: 118.87, lat: 28.94 }, { name: '舟山', lon: 122.21, lat: 29.99 },
    { name: '台州', lon: 121.43, lat: 28.66 }, { name: '丽水', lon: 119.92, lat: 28.47 } ] },
  { name: '安徽', cities: [
    { name: '合肥', lon: 117.28, lat: 31.86 }, { name: '芜湖', lon: 118.38, lat: 31.33 }, { name: '蚌埠', lon: 117.39, lat: 32.92 },
    { name: '淮南', lon: 117.02, lat: 32.63 }, { name: '马鞍山', lon: 118.51, lat: 31.69 }, { name: '淮北', lon: 116.79, lat: 33.96 },
    { name: '铜陵', lon: 117.82, lat: 30.94 }, { name: '安庆', lon: 117.05, lat: 30.54 }, { name: '黄山', lon: 118.32, lat: 29.71 },
    { name: '滁州', lon: 118.32, lat: 32.30 }, { name: '阜阳', lon: 115.82, lat: 32.90 }, { name: '宿州', lon: 116.98, lat: 33.63 },
    { name: '六安', lon: 116.52, lat: 31.74 }, { name: '亳州', lon: 115.78, lat: 33.84 }, { name: '池州', lon: 117.49, lat: 30.66 },
    { name: '宣城', lon: 118.76, lat: 30.95 } ] },
  { name: '福建', cities: [
    { name: '福州', lon: 119.30, lat: 26.08 }, { name: '厦门', lon: 118.09, lat: 24.48 }, { name: '莆田', lon: 119.01, lat: 25.45 },
    { name: '三明', lon: 117.64, lat: 26.27 }, { name: '泉州', lon: 118.68, lat: 24.87 }, { name: '漳州', lon: 117.65, lat: 24.51 },
    { name: '南平', lon: 118.18, lat: 26.64 }, { name: '龙岩', lon: 117.02, lat: 25.08 }, { name: '宁德', lon: 119.55, lat: 26.67 } ] },
  { name: '江西', cities: [
    { name: '南昌', lon: 115.86, lat: 28.68 }, { name: '景德镇', lon: 117.18, lat: 29.27 }, { name: '萍乡', lon: 113.85, lat: 27.62 },
    { name: '九江', lon: 116.00, lat: 29.71 }, { name: '新余', lon: 114.93, lat: 27.81 }, { name: '鹰潭', lon: 117.07, lat: 28.26 },
    { name: '赣州', lon: 114.94, lat: 25.83 }, { name: '吉安', lon: 114.99, lat: 27.11 }, { name: '宜春', lon: 114.39, lat: 27.81 },
    { name: '抚州', lon: 116.36, lat: 27.95 }, { name: '上饶', lon: 117.94, lat: 28.45 } ] },
  { name: '山东', cities: [
    { name: '济南', lon: 117.00, lat: 36.65 }, { name: '青岛', lon: 120.38, lat: 36.07 }, { name: '淄博', lon: 118.05, lat: 36.81 },
    { name: '枣庄', lon: 117.32, lat: 34.81 }, { name: '东营', lon: 118.67, lat: 37.43 }, { name: '烟台', lon: 121.39, lat: 37.54 },
    { name: '潍坊', lon: 119.16, lat: 36.71 }, { name: '济宁', lon: 116.59, lat: 35.41 }, { name: '泰安', lon: 117.13, lat: 36.19 },
    { name: '威海', lon: 122.12, lat: 37.51 }, { name: '日照', lon: 119.53, lat: 35.42 }, { name: '临沂', lon: 118.36, lat: 35.10 },
    { name: '德州', lon: 116.36, lat: 37.44 }, { name: '聊城', lon: 115.98, lat: 36.46 }, { name: '滨州', lon: 118.02, lat: 37.38 },
    { name: '菏泽', lon: 115.48, lat: 35.23 } ] },
  { name: '河南', cities: [
    { name: '郑州', lon: 113.63, lat: 34.75 }, { name: '开封', lon: 114.31, lat: 34.80 }, { name: '洛阳', lon: 112.45, lat: 34.62 },
    { name: '平顶山', lon: 113.19, lat: 33.77 }, { name: '安阳', lon: 114.39, lat: 36.10 }, { name: '鹤壁', lon: 114.30, lat: 35.75 },
    { name: '新乡', lon: 113.93, lat: 35.30 }, { name: '焦作', lon: 113.24, lat: 35.22 }, { name: '濮阳', lon: 115.04, lat: 35.77 },
    { name: '许昌', lon: 113.85, lat: 34.04 }, { name: '漯河', lon: 114.03, lat: 33.58 }, { name: '三门峡', lon: 111.19, lat: 34.78 },
    { name: '南阳', lon: 112.53, lat: 33.00 }, { name: '商丘', lon: 115.65, lat: 34.44 }, { name: '信阳', lon: 114.09, lat: 32.15 },
    { name: '周口', lon: 114.70, lat: 33.63 }, { name: '驻马店', lon: 114.02, lat: 33.01 } ] },
  { name: '湖北', cities: [
    { name: '武汉', lon: 114.30, lat: 30.59 }, { name: '黄石', lon: 115.04, lat: 30.20 }, { name: '十堰', lon: 110.79, lat: 32.65 },
    { name: '宜昌', lon: 111.29, lat: 30.69 }, { name: '襄阳', lon: 112.12, lat: 32.01 }, { name: '鄂州', lon: 114.89, lat: 30.40 },
    { name: '荆门', lon: 112.20, lat: 31.04 }, { name: '孝感', lon: 113.93, lat: 30.93 }, { name: '荆州', lon: 112.24, lat: 30.33 },
    { name: '黄冈', lon: 114.87, lat: 30.45 }, { name: '咸宁', lon: 114.32, lat: 29.84 }, { name: '随州', lon: 113.37, lat: 31.69 },
    { name: '恩施', lon: 109.49, lat: 30.27 } ] },
  { name: '湖南', cities: [
    { name: '长沙', lon: 112.94, lat: 28.23 }, { name: '株洲', lon: 113.13, lat: 27.83 }, { name: '湘潭', lon: 112.94, lat: 27.83 },
    { name: '衡阳', lon: 112.57, lat: 26.89 }, { name: '邵阳', lon: 111.47, lat: 27.24 }, { name: '岳阳', lon: 113.13, lat: 29.37 },
    { name: '常德', lon: 111.69, lat: 29.04 }, { name: '张家界', lon: 110.48, lat: 29.13 }, { name: '益阳', lon: 112.36, lat: 28.55 },
    { name: '郴州', lon: 113.03, lat: 25.77 }, { name: '永州', lon: 111.61, lat: 26.42 }, { name: '怀化', lon: 110.00, lat: 27.55 },
    { name: '娄底', lon: 112.00, lat: 27.73 }, { name: '湘西', lon: 109.74, lat: 28.31 } ] },
  { name: '广东', cities: [
    { name: '广州', lon: 113.26, lat: 23.13 }, { name: '韶关', lon: 113.60, lat: 24.81 }, { name: '深圳', lon: 114.06, lat: 22.54 },
    { name: '珠海', lon: 113.55, lat: 22.27 }, { name: '汕头', lon: 116.68, lat: 23.35 }, { name: '佛山', lon: 113.12, lat: 23.02 },
    { name: '江门', lon: 113.08, lat: 22.58 }, { name: '湛江', lon: 110.36, lat: 21.27 }, { name: '茂名', lon: 110.93, lat: 21.66 },
    { name: '肇庆', lon: 112.47, lat: 23.05 }, { name: '惠州', lon: 114.42, lat: 23.11 }, { name: '梅州', lon: 116.12, lat: 24.29 },
    { name: '汕尾', lon: 115.37, lat: 22.79 }, { name: '河源', lon: 114.70, lat: 23.74 }, { name: '阳江', lon: 111.98, lat: 21.86 },
    { name: '清远', lon: 113.05, lat: 23.68 }, { name: '东莞', lon: 113.75, lat: 23.02 }, { name: '中山', lon: 113.39, lat: 22.52 },
    { name: '潮州', lon: 116.62, lat: 23.66 }, { name: '揭阳', lon: 116.37, lat: 23.55 }, { name: '云浮', lon: 112.04, lat: 22.92 } ] },
  { name: '广西', cities: [
    { name: '南宁', lon: 108.37, lat: 22.82 }, { name: '柳州', lon: 109.42, lat: 24.31 }, { name: '桂林', lon: 110.29, lat: 25.27 },
    { name: '梧州', lon: 111.30, lat: 23.48 }, { name: '北海', lon: 109.12, lat: 21.48 }, { name: '防城港', lon: 108.35, lat: 21.69 },
    { name: '钦州', lon: 108.65, lat: 21.98 }, { name: '贵港', lon: 109.60, lat: 23.11 }, { name: '玉林', lon: 110.16, lat: 22.63 },
    { name: '百色', lon: 106.62, lat: 23.90 }, { name: '贺州', lon: 111.55, lat: 24.41 }, { name: '河池', lon: 108.06, lat: 24.70 },
    { name: '来宾', lon: 109.23, lat: 23.73 }, { name: '崇左', lon: 107.36, lat: 22.38 } ] },
  { name: '海南', cities: [
    { name: '海口', lon: 110.20, lat: 20.04 }, { name: '三亚', lon: 109.51, lat: 18.25 }, { name: '儋州', lon: 109.58, lat: 19.52 },
    { name: '三沙', lon: 112.34, lat: 16.83 }, { name: '琼海', lon: 110.47, lat: 19.26 }, { name: '文昌', lon: 110.75, lat: 19.61 },
    { name: '万宁', lon: 110.39, lat: 18.80 }, { name: '东方', lon: 108.65, lat: 19.10 } ] },
  { name: '四川', cities: [
    { name: '成都', lon: 104.07, lat: 30.57 }, { name: '自贡', lon: 104.78, lat: 29.34 }, { name: '攀枝花', lon: 101.72, lat: 26.58 },
    { name: '泸州', lon: 105.44, lat: 28.87 }, { name: '德阳', lon: 104.40, lat: 31.13 }, { name: '绵阳', lon: 104.68, lat: 31.47 },
    { name: '广元', lon: 105.84, lat: 32.44 }, { name: '遂宁', lon: 105.59, lat: 30.53 }, { name: '内江', lon: 105.06, lat: 29.58 },
    { name: '乐山', lon: 103.76, lat: 29.55 }, { name: '南充', lon: 106.08, lat: 30.80 }, { name: '眉山', lon: 103.83, lat: 30.05 },
    { name: '宜宾', lon: 104.64, lat: 28.75 }, { name: '广安', lon: 106.63, lat: 30.46 }, { name: '达州', lon: 107.50, lat: 31.21 },
    { name: '雅安', lon: 103.04, lat: 29.99 }, { name: '巴中', lon: 106.75, lat: 31.86 }, { name: '资阳', lon: 104.64, lat: 30.13 },
    { name: '阿坝', lon: 102.22, lat: 31.90 }, { name: '甘孜', lon: 101.96, lat: 30.05 }, { name: '凉山', lon: 102.26, lat: 27.88 } ] },
  { name: '贵州', cities: [
    { name: '贵阳', lon: 106.71, lat: 26.65 }, { name: '六盘水', lon: 104.83, lat: 26.59 }, { name: '遵义', lon: 106.93, lat: 27.73 },
    { name: '安顺', lon: 105.93, lat: 26.25 }, { name: '毕节', lon: 105.29, lat: 27.30 }, { name: '铜仁', lon: 109.19, lat: 27.72 },
    { name: '黔西南', lon: 104.90, lat: 25.09 }, { name: '黔东南', lon: 107.98, lat: 26.58 }, { name: '黔南', lon: 107.52, lat: 26.26 } ] },
  { name: '云南', cities: [
    { name: '昆明', lon: 102.83, lat: 24.88 }, { name: '曲靖', lon: 103.80, lat: 25.49 }, { name: '玉溪', lon: 102.54, lat: 24.35 },
    { name: '保山', lon: 99.17, lat: 25.11 }, { name: '昭通', lon: 103.72, lat: 27.34 }, { name: '丽江', lon: 100.23, lat: 26.86 },
    { name: '普洱', lon: 100.97, lat: 22.78 }, { name: '临沧', lon: 100.09, lat: 23.88 }, { name: '楚雄', lon: 101.55, lat: 25.04 },
    { name: '红河', lon: 103.38, lat: 23.37 }, { name: '文山', lon: 104.24, lat: 23.37 }, { name: '西双版纳', lon: 100.80, lat: 22.01 },
    { name: '大理', lon: 100.23, lat: 25.61 }, { name: '德宏', lon: 98.58, lat: 24.44 }, { name: '怒江', lon: 98.85, lat: 25.85 },
    { name: '迪庆', lon: 99.71, lat: 27.83 } ] },
  { name: '西藏', cities: [
    { name: '拉萨', lon: 91.11, lat: 29.65 }, { name: '日喀则', lon: 88.88, lat: 29.27 }, { name: '昌都', lon: 97.17, lat: 31.14 },
    { name: '林芝', lon: 94.36, lat: 29.65 }, { name: '山南', lon: 91.77, lat: 29.24 }, { name: '那曲', lon: 92.06, lat: 31.48 },
    { name: '阿里', lon: 80.11, lat: 32.50 } ] },
  { name: '陕西', cities: [
    { name: '西安', lon: 108.95, lat: 34.26 }, { name: '铜川', lon: 108.95, lat: 34.90 }, { name: '宝鸡', lon: 107.24, lat: 34.36 },
    { name: '咸阳', lon: 108.71, lat: 34.33 }, { name: '渭南', lon: 109.51, lat: 34.50 }, { name: '延安', lon: 109.49, lat: 36.60 },
    { name: '汉中', lon: 107.03, lat: 33.07 }, { name: '榆林', lon: 109.74, lat: 38.29 }, { name: '安康', lon: 109.03, lat: 32.69 },
    { name: '商洛', lon: 109.94, lat: 33.87 } ] },
  { name: '甘肃', cities: [
    { name: '兰州', lon: 103.83, lat: 36.06 }, { name: '嘉峪关', lon: 98.29, lat: 39.77 }, { name: '金昌', lon: 102.19, lat: 38.52 },
    { name: '白银', lon: 104.14, lat: 36.55 }, { name: '天水', lon: 105.72, lat: 34.58 }, { name: '武威', lon: 102.64, lat: 37.93 },
    { name: '张掖', lon: 100.45, lat: 38.93 }, { name: '平凉', lon: 106.68, lat: 35.54 }, { name: '酒泉', lon: 98.51, lat: 39.74 },
    { name: '庆阳', lon: 107.64, lat: 35.71 }, { name: '定西', lon: 104.63, lat: 35.58 }, { name: '陇南', lon: 104.93, lat: 33.40 },
    { name: '临夏', lon: 103.21, lat: 35.60 }, { name: '甘南', lon: 102.91, lat: 34.99 } ] },
  { name: '青海', cities: [
    { name: '西宁', lon: 101.78, lat: 36.62 }, { name: '海东', lon: 102.10, lat: 36.50 }, { name: '海北', lon: 100.90, lat: 36.96 },
    { name: '黄南', lon: 102.02, lat: 35.52 }, { name: '海南州', lon: 100.62, lat: 36.29 }, { name: '果洛', lon: 100.24, lat: 34.47 },
    { name: '玉树', lon: 97.01, lat: 33.00 }, { name: '海西', lon: 97.37, lat: 37.37 } ] },
  { name: '宁夏', cities: [
    { name: '银川', lon: 106.23, lat: 38.49 }, { name: '石嘴山', lon: 106.38, lat: 39.02 }, { name: '吴忠', lon: 106.20, lat: 37.99 },
    { name: '固原', lon: 106.24, lat: 36.02 }, { name: '中卫', lon: 105.19, lat: 37.51 } ] },
  { name: '新疆', cities: [
    { name: '乌鲁木齐', lon: 87.62, lat: 43.82 }, { name: '克拉玛依', lon: 84.89, lat: 45.59 }, { name: '吐鲁番', lon: 89.18, lat: 42.95 },
    { name: '哈密', lon: 93.51, lat: 42.83 }, { name: '昌吉', lon: 87.30, lat: 44.01 }, { name: '博尔塔拉', lon: 82.07, lat: 44.90 },
    { name: '巴音郭楞', lon: 86.15, lat: 41.77 }, { name: '阿克苏', lon: 80.27, lat: 41.17 }, { name: '克孜勒苏', lon: 76.17, lat: 39.71 },
    { name: '喀什', lon: 75.99, lat: 39.47 }, { name: '和田', lon: 79.92, lat: 37.11 }, { name: '伊犁', lon: 81.32, lat: 43.92 },
    { name: '塔城', lon: 82.97, lat: 46.75 }, { name: '阿勒泰', lon: 88.14, lat: 47.85 } ] },
  { name: '香港', cities: [{ name: '香港', lon: 114.17, lat: 22.32 }] },
  { name: '澳门', cities: [{ name: '澳门', lon: 113.55, lat: 22.20 }] },
  { name: '台湾', cities: [
    { name: '台北', lon: 121.56, lat: 25.04 }, { name: '高雄', lon: 120.31, lat: 22.63 }, { name: '台中', lon: 120.68, lat: 24.14 },
    { name: '台南', lon: 120.21, lat: 23.00 }, { name: '新竹', lon: 120.97, lat: 24.81 }, { name: '基隆', lon: 121.74, lat: 25.13 } ] }
]
