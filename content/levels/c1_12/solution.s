# 算出 t2 = t0 算术右移 2 位；t3 = t0 与 t1 按无符号比较的较大者
srai t2, t0, 2
bltu t0, t1, pick_t1
mv   t3, t0
j    done
pick_t1:
mv   t3, t1
done:
ecall
