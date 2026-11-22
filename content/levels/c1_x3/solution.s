# 性能挑战：在升序数组 t0 (长 t1) 中二分查找 t2，下标存入 t3（不存在存 -1）
addi t3, zero, -1
addi t4, zero, 0
addi t5, t1, -1
loop:
blt  t5, t4, done
add  t6, t4, t5
srli t6, t6, 1
slli a0, t6, 2
add  a0, t0, a0
lw   a1, 0(a0)
beq  a1, t2, found
blt  a1, t2, go_right
addi t5, t6, -1
j    loop
go_right:
addi t4, t6, 1
j    loop
found:
mv   t3, t6
done:
addi a7, zero, 0
ecall
