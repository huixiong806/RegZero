# 将 t0 处以 0 结尾的小写字符串原地转为大写，长度存入 t1
addi t1, zero, 0
loop:
lbu  t2, 0(t0)
beq  t2, zero, done
addi t2, t2, -32
sb   t2, 0(t0)
addi t0, t0, 1
addi t1, t1, 1
j    loop
done:
ecall
