# 拆出 t0 (0x00RRGGBB) 的 t1=R, t2=G, t3=B，并拼出 t4 = 0x00BBGGRR
srli t1, t0, 16
andi t1, t1, 0xFF
srli t2, t0, 8
andi t2, t2, 0xFF
andi t3, t0, 0xFF
slli t4, t3, 16
slli t5, t2, 8
or   t4, t4, t5
or   t4, t4, t1
ecall
