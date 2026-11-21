# 任务：比较 t0 与 t1，将较大值存入 t2（下面代码漏了一行，先直接点运行看看哪里出错！）
blt t0, t1, use_t1
mv  t2, t0

use_t1:
mv  t2, t1
done:
ecall
